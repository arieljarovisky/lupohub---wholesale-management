import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import { listPayments, createPayment, importPaymentsFromExcel, updatePaymentDate, updateImportedPaymentDate } from '../controllers/payments.controller';

const router = Router();
router.use(authMiddleware as any);
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', listPayments as any);
router.post('/', createPayment as any);
router.patch('/imported/date', updateImportedPaymentDate as any);
router.patch('/:id/date', updatePaymentDate as any);
router.post('/import-excel', upload.array('files', 10), importPaymentsFromExcel as any);

export default router;

