import { Router } from 'express';
import { 
  getIntegrationStatus, 
  getMercadoLibreAuthUrl, 
  handleMercadoLibreCallback,
  getTiendaNubeAuthUrl,
  handleTiendaNubeCallback,
  syncProductsFromTiendaNube,
  disconnectIntegration
} from '../controllers/integrations.controller';

const router = Router();

router.get('/status', getIntegrationStatus);

// Mercado Libre
router.get('/mercadolibre/auth', getMercadoLibreAuthUrl);
router.get('/mercadolibre/callback', handleMercadoLibreCallback);

// Tienda Nube
router.get('/tiendanube/auth', getTiendaNubeAuthUrl);
router.get('/tiendanube/callback', handleTiendaNubeCallback);
router.post('/tiendanube/sync', syncProductsFromTiendaNube);
router.delete('/:platform/disconnect', disconnectIntegration);

export default router;
