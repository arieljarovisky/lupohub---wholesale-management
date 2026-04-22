import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import { listPayments, createPayment, importPaymentsFromExcel, importIibbRetPer } from '../controllers/payments.controller';

const router = Router();
router.use(authMiddleware as any);
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', listPayments as any);
router.post('/', createPayment as any);
router.post('/import-excel', upload.array('files', 10), importPaymentsFromExcel as any);
router.post('/import-retper', upload.array('files', 10), importIibbRetPer as any);

export default router;

