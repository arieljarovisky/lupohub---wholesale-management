import { Router } from 'express';
import { isAfipConfigured, getAfipIssuerData } from '../services/afip.service';
import { optionalAuthMiddleware } from '../middleware/auth';

const router = Router();
router.use(optionalAuthMiddleware);

/** Indica si AFIP está configurado en el servidor (CUIT + access token). */
router.get('/status', (_req, res) => {
  res.json({ configured: isAfipConfigured() });
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

export default router;
