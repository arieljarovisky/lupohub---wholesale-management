import { Router } from 'express';
import { getPublicTrackingByCode } from '../controllers/publicTracking.controller';

const router = Router();

/** Seguimiento público de envíos express (sin autenticación). */
router.get('/tracking/:trackingCode', getPublicTrackingByCode);
router.get('/tracking', getPublicTrackingByCode);

export default router;
