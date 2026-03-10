import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listCatalogs,
  createCatalogWithUrl,
  uploadCatalog,
  uploadCatalogMiddleware,
  getCatalogFile,
  deleteCatalog
} from '../controllers/catalogs.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', listCatalogs);
router.get('/:id/file', getCatalogFile);
router.post('/upload', uploadCatalogMiddleware, uploadCatalog);
router.post('/', createCatalogWithUrl);
router.delete('/:id', deleteCatalog);

export default router;
