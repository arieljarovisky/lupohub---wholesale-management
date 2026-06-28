import { Router } from 'express';
import {
  confirmPublicDelivery,
  getPublicDeliveryPage,
} from '../controllers/publicTracking.controller';

const router = Router();

/** Confirmación de entrega por repartidor (QR en etiqueta express). */
router.get('/entrega/:trackingCode', getPublicDeliveryPage);
router.post('/entrega/:trackingCode', confirmPublicDelivery);

export default router;
