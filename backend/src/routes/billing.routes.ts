import { Router } from 'express';
import {
  listBilling,
  exportBilling,
  exportRetPerTxt,
  importAgipPadron,
  importAgipPadronStart,
  importAgipPadronChunk,
  exportBillingByCustomersFile,
  exportVentasJurisdiccionXlsx
} from '../controllers/billing.controller';
import { authMiddleware, billingAccessMiddleware } from '../middleware/auth';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });
const uploadAgipPadronFile = (req: any, res: any, next: any) => {
  upload.single('file')(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'El archivo supera el tamaño máximo permitido (80MB).' });
    }
    return res.status(400).json({ message: err?.message || 'Error subiendo archivo de padrón AGIP.' });
  });
};

router.use(authMiddleware, billingAccessMiddleware);

router.get('/', listBilling);
router.get('/export', exportBilling);
router.get('/export-retper', exportRetPerTxt);
router.get('/export-ventas-jurisdiccion', exportVentasJurisdiccionXlsx);
router.post('/export-by-customers-file', uploadAgipPadronFile, exportBillingByCustomersFile);
router.post('/agip-padron/import/start', importAgipPadronStart);
router.post('/agip-padron/import/chunk', importAgipPadronChunk);
router.post('/agip-padron/import', uploadAgipPadronFile, importAgipPadron);

export default router;

