import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  uploadCatalogImage,
  uploadCatalogImageMiddleware,
  serveCatalogImage,
} from '../controllers/catalogImages.controller';

const router = Router();

// Servir imágenes es público (las etiquetas <img> no envían token).
router.get('/:file', serveCatalogImage);
// Subir requiere login (y rol ADMIN, validado en el controlador).
router.post('/', authMiddleware, uploadCatalogImageMiddleware, uploadCatalogImage);

export default router;
