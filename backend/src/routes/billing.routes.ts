import { Router } from 'express';
import {
  listBilling,
  exportBilling,
  exportRetPerTxt,
  importAgipPadron,
  importAgipPadronStart,
  importAgipPadronChunk,
  exportBillingByCustomersFile,
  exportVentasJurisdiccionXlsx,
  printBilling
} from '../controllers/billing.controller';
import {
  createManualComprobante,
  createManualComprobanteMultipart,
  getManualComprobante,
  getManualComprobantePdf,
  updateManualComprobante,
  updateManualComprobanteMultipart,
  uploadManualComprobantePdfHandler
} from '../controllers/manualComprobantes.controller';
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
router.post('/manual-comprobantes', createManualComprobante as any);
router.post(
  '/manual-comprobantes/upload',
  uploadManualComprobantePdfHandler,
  createManualComprobanteMultipart as any
);
router.get('/manual-comprobantes/:id/pdf', getManualComprobantePdf as any);
router.get('/manual-comprobantes/:id', getManualComprobante as any);
router.patch('/manual-comprobantes/:id', updateManualComprobante as any);
router.patch(
  '/manual-comprobantes/:id/upload',
  uploadManualComprobantePdfHandler,
  updateManualComprobanteMultipart as any
);
router.get('/export', exportBilling);
router.get('/print', printBilling);
router.get('/export-retper', exportRetPerTxt);
router.get('/export-ventas-jurisdiccion', exportVentasJurisdiccionXlsx);
router.post('/export-by-customers-file', uploadAgipPadronFile, exportBillingByCustomersFile);
router.post('/agip-padron/import/start', importAgipPadronStart);
router.post('/agip-padron/import/chunk', importAgipPadronChunk);
router.post('/agip-padron/import', uploadAgipPadronFile, importAgipPadron);

export default router;

