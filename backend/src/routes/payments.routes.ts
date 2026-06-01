import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import {
  listPayments,
  createPayment,
  importPaymentsFromExcel,
  updatePaymentDate,
  updateImportedPaymentDate,
  getInvoicesOutstandingHandler,
  getOrdersOutstandingHandler,
  postPaymentAllocatePreview,
  patchPaymentInvoices,
  getImportedReceiptLinkInfo,
  deletePayment
} from '../controllers/payments.controller';

const router = Router();
router.use(authMiddleware as any);
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', listPayments as any);
router.get('/imported/link-info', getImportedReceiptLinkInfo as any);
router.get('/invoice-outstanding', getInvoicesOutstandingHandler as any);
router.get('/order-outstanding', getOrdersOutstandingHandler as any);
router.post('/allocate-preview', postPaymentAllocatePreview as any);
router.post('/', createPayment as any);
router.patch('/imported/date', updateImportedPaymentDate as any);
router.patch('/:id/invoices', patchPaymentInvoices as any);
router.patch('/:id/date', updatePaymentDate as any);
router.delete('/:id', deletePayment as any);
router.post('/import-excel', upload.array('files', 10), importPaymentsFromExcel as any);

export default router;

