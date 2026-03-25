import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { listPayments, createPayment } from '../controllers/payments.controller';

const router = Router();
router.use(authMiddleware as any);

router.get('/', listPayments as any);
router.post('/', createPayment as any);

export default router;

