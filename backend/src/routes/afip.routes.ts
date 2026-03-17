import { Router, Request, Response } from 'express';
import { isAfipConfigured, getAfipIssuerData, isAfipProduction, getCondicionIvaByCuit } from '../services/afip.service';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(optionalAuthMiddleware);

/** Indica si AFIP está configurado y si es ambiente producción (para que las facturas lleguen a AFIP real). */
router.get('/status', (_req, res) => {
  res.json({
    configured: isAfipConfigured(),
    production: isAfipProduction()
  });
});

/** Datos del emisor para la factura (CUIT, razón social, domicilio desde env). Usar en la vista de factura si no hay remitente en localStorage. */
router.get('/issuer', (_req, res) => {
  const data = getAfipIssuerData();
  if (!data) return res.json({ cuit: '', businessName: '', address: '', city: '' });
  res.json({
    cuit: data.cuit,
    businessName: data.businessName ?? '',
    address: data.address ?? '',
    city: data.city ?? ''
  });
});

/** Condición IVA (y opcional razón social, domicilio) de un CUIT vía Padrón AFIP. Requiere login. */
router.get('/condicion-iva', authMiddleware, async (req: Request, res: Response) => {
  const cuit = (req.query.cuit as string)?.trim();
  if (!cuit) {
    return res.status(400).json({ error: 'Falta el parámetro cuit.' });
  }
  try {
    const result = await getCondicionIvaByCuit(cuit);
    res.json(result);
  } catch (err: any) {
    const message = err?.message || 'Error al consultar AFIP.';
    res.status(400).json({ error: message });
  }
});

export default router;
