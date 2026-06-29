import { Router } from 'express';
import {
  confirmPublicDelivery,
  getPublicDeliveryPage,
  getPublicTrackingByCode,
  getPublicTrackingPage,
} from '../controllers/publicTracking.controller';

const router = Router();

/** Consulta pública de seguimiento express (JSON). */
router.get('/tracking/:trackingCode', getPublicTrackingByCode);
router.get('/tracking', getPublicTrackingByCode);

/** Formulario embebible para Tienda Nube (HTML inline, sin iframe). */
router.get('/seguimiento', getPublicTrackingPage);

/** Confirmación de entrega por repartidor (QR en etiqueta express). */
router.get('/entrega/:trackingCode', getPublicDeliveryPage);
router.post('/entrega/:trackingCode', confirmPublicDelivery);

export default router;
