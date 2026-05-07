import { Router } from 'express';
import { listBilling, exportBilling, exportRetPerTxt, importAgipPadron } from '../controllers/billing.controller';
import { authMiddleware, billingAccessMiddleware } from '../middleware/auth';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });

router.use(authMiddleware, billingAccessMiddleware);

router.get('/', listBilling);
router.get('/export', exportBilling);
router.get('/export-retper', exportRetPerTxt);
router.post('/agip-padron/import', upload.single('file'), importAgipPadron);

export default router;

