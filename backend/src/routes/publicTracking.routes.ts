import { Router } from 'express';
import {
  confirmPublicDelivery,
  getPublicDeliveryPage,
  getPublicTrackingByCode,
  getPublicTrackingPage,
  getSeguimientoWidgetScript,
} from '../controllers/publicTracking.controller';

const router = Router();

/** Widget JS para consulta en el sitio (multilupo.com.ar) sin redirigir. */
router.get('/seguimiento-widget.js', getSeguimientoWidgetScript);

/** Consulta pública de seguimiento express (JSON). */
router.get('/tracking/:trackingCode', getPublicTrackingByCode);
router.get('/tracking', getPublicTrackingByCode);

/** Formulario embebible para Tienda Nube (HTML inline, sin iframe). */
router.get('/seguimiento', getPublicTrackingPage);

/** Confirmación de entrega por repartidor (QR en etiqueta express). */
router.get('/entrega/:trackingCode', getPublicDeliveryPage);
router.post('/entrega/:trackingCode', confirmPublicDelivery);

export default router;
