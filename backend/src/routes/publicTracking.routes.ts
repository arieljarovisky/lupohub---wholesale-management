import { Router } from 'express';
import {
  confirmPublicDelivery,
  getPublicDeliveryPage,
  getPublicTrackingByCode,
} from '../controllers/publicTracking.controller';

const router = Router();

/** Seguimiento público de envíos express (sin autenticación). */
router.get('/tracking/:trackingCode', getPublicTrackingByCode);
router.get('/tracking', getPublicTrackingByCode);

/** Confirmación de entrega por repartidor (QR en etiqueta express). */
router.get('/entrega/:trackingCode', getPublicDeliveryPage);
router.post('/entrega/:trackingCode', confirmPublicDelivery);

export default router;
