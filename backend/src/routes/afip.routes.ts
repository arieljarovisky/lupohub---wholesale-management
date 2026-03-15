import { Router } from 'express';
import { isAfipConfigured } from '../services/afip.service';
import { optionalAuthMiddleware } from '../middleware/auth';

const router = Router();
router.use(optionalAuthMiddleware);

/** Indica si AFIP está configurado en el servidor (CUIT + access token). */
router.get('/status', (_req, res) => {
  res.json({ configured: isAfipConfigured() });
});

export default router;
