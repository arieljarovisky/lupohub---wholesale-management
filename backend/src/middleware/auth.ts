import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'No autorizado' });
  try {
    const secret = process.env.JWT_SECRET || 'devsecret';
    const decoded = jwt.verify(token, secret) as any;
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido' });
  }
};

/** No devuelve 401 si no hay token; solo setea req.user cuando el token es válido. */
export const optionalAuthMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const secret = process.env.JWT_SECRET || 'devsecret';
    const decoded = jwt.verify(token, secret) as any;
    (req as any).user = decoded;
  } catch {
    /* token inválido */
  }
  next();
};

/** Solo permite usuarios con rol ADMIN o DEPOSITO (en BD el rol se guarda como WAREHOUSE). Requiere authMiddleware antes. */
export const adminOrDepositoMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const role = (req as any).user?.role;
  if (role === 'ADMIN' || role === 'DEPOSITO' || role === 'WAREHOUSE') return next();
  return res.status(403).json({ message: 'Solo para usuarios con rol ADMIN o DEPOSITO' });
};

/** Lista/export de comprobantes y pagos (módulo Facturación). Vendedores sin acceso. */
export const billingAccessMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const role = (req as any).user?.role;
  if (role === 'ADMIN' || role === 'DEPOSITO' || role === 'WAREHOUSE') return next();
  return res.status(403).json({ message: 'Sin permiso para facturación' });
};
