import { Request, Response } from 'express';
import { get } from '../database/db';
import jwt from 'jsonwebtoken';

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
    const secret = process.env.JWT_SECRET || 'devsecret';
    const token = jwt.sign(
      { id: safeUser.id, email: safeUser.email, role: safeUser.role },
      secret,
      { expiresIn: '2h' }
    );
    return res.json({ user: safeUser, token });
  } catch (error) {
    return res.status(500).json({ message: 'Error al autenticar' });
  }
};
